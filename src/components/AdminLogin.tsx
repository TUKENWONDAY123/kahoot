import React, { useState } from 'react';
import { View } from '../App';
import { motion } from 'motion/react';

export default function AdminLogin({ onNavigate }: { onNavigate: (view: View, data?: any) => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'admin') {
      onNavigate('admin-dashboard');
    } else {
      setError('Incorrect password');
    }
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
        <h1 className="text-5xl font-black mb-8 text-purple-700 tracking-tight">Admin Login</h1>
        <form onSubmit={handleLogin} className="space-y-6">
          <input 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full p-5 border-4 border-gray-200 rounded-2xl text-center text-3xl font-black focus:outline-none focus:border-purple-600 transition-colors"
          />
          {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-500 font-bold">{error}</motion.p>}
          <button type="submit" className="tactile-btn w-full py-5 bg-gray-900 text-white font-black text-2xl rounded-2xl shadow-[0_8px_0_0_#000000] hover:bg-gray-800">
            Login
          </button>
        </form>
        <button onClick={() => onNavigate('home')} className="mt-8 text-gray-500 hover:text-gray-800 font-bold">
          Back
        </button>
      </motion.div>
    </div>
  );
}
