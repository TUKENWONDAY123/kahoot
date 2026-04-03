import React, { useState } from 'react';
import { View } from '../App';
import { supabase } from '../supabaseClient';
import { motion } from 'motion/react';

export default function JoinGame({ onNavigate }: { onNavigate: (view: View, data?: any) => void }) {
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || !name) return setError('Please enter PIN and Name');

    // Find session
    const { data: sessionData, error: sessionError } = await supabase
      .from('game_sessions')
      .select('*')
      .eq('pin', pin)
      .eq('status', 'waiting')
      .single();

    if (sessionError || !sessionData) {
      return setError('Game not found or already started');
    }

    // Join game
    const { data: playerData, error: playerError } = await supabase
      .from('players')
      .insert([{ session_id: sessionData.id, name, score: 0, last_answer_correct: false }])
      .select()
      .single();

    if (playerError || !playerData) {
      return setError('Error joining game');
    }

    onNavigate('player-game', { session: sessionData, player: playerData });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-kahoot p-4 relative overflow-hidden">
      {/* Floating blobs */}
      <div className="absolute top-0 left-1/4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-2xl opacity-70 animate-blob"></div>
      <div className="absolute top-0 right-1/4 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-2xl opacity-70 animate-blob" style={{ animationDelay: '2s' }}></div>

      <motion.div 
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.5 }}
        className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md text-center relative z-10"
      >
        <h1 className="text-5xl font-black mb-8 text-purple-700 tracking-tight">Join Game</h1>
        <form onSubmit={handleJoin} className="space-y-6">
          <input 
            type="text" 
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Game PIN"
            className="w-full p-5 border-4 border-gray-200 rounded-2xl text-center text-3xl font-black focus:outline-none focus:border-purple-600 transition-colors"
          />
          <input 
            type="text" 
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nickname"
            className="w-full p-5 border-4 border-gray-200 rounded-2xl text-center text-2xl font-bold focus:outline-none focus:border-purple-600 transition-colors"
          />
          {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-500 font-bold">{error}</motion.p>}
          <button type="submit" className="tactile-btn w-full py-5 bg-gray-900 text-white font-black text-2xl rounded-2xl shadow-[0_8px_0_0_#000000] hover:bg-gray-800">
            Enter
          </button>
        </form>
        <button onClick={() => onNavigate('home')} className="mt-8 text-gray-500 hover:text-gray-800 font-bold">
          Back
        </button>
      </motion.div>
    </div>
  );
}

