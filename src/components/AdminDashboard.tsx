import React, { useEffect, useState } from 'react';
import { View } from '../App';
import { supabase } from '../supabaseClient';
import { Quiz } from '../types';
import { motion, AnimatePresence } from 'motion/react';

export default function AdminDashboard({ onNavigate }: { onNavigate: (view: View, data?: any) => void }) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchQuizzes();
  }, []);

  const fetchQuizzes = async () => {
    const { data, error } = await supabase.from('quizzes').select('*').order('created_at', { ascending: false });
    if (data) setQuizzes(data);
    setLoading(false);
  };

  const handleGenerateCode = async (quiz: Quiz) => {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const { data, error } = await supabase.from('game_sessions').insert([
      { quiz_id: quiz.id, pin, status: 'waiting', current_question_index: 0 }
    ]).select().single();

    if (data) {
      onNavigate('host-game', { session: data, quiz });
    } else {
      alert('Error creating game session. Make sure Supabase is configured properly.');
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 p-8 overflow-y-auto relative">
      {/* Decorative blobs */}
      <div className="absolute top-0 left-0 w-full h-96 bg-kahoot opacity-10 rounded-b-[100px] -z-10"></div>

      <div className="max-w-4xl mx-auto w-full relative z-10">
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex justify-between items-center mb-12"
        >
          <h1 className="text-5xl font-black text-gray-800 tracking-tight">Dashboard</h1>
          <div className="space-x-4">
            <button onClick={() => onNavigate('home')} className="text-gray-500 hover:text-gray-800 font-bold">
              Logout
            </button>
            <button 
              onClick={() => onNavigate('create-game')}
              className="tactile-btn px-8 py-4 bg-purple-600 text-white font-black text-xl rounded-2xl shadow-[0_8px_0_0_#4c1d95] hover:bg-purple-500"
            >
              + Create Quiz
            </button>
          </div>
        </motion.div>

        <div className="grid gap-6">
          <AnimatePresence>
            {loading ? (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 text-gray-400 font-bold text-2xl">Loading...</motion.p>
            ) : quizzes.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 text-gray-400 font-bold text-2xl">
                No quizzes yet. Create one!
              </motion.div>
            ) : (
              quizzes.map((quiz, i) => (
                <motion.div 
                  key={quiz.id}
                  initial={{ x: -50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white p-8 rounded-3xl shadow-xl flex justify-between items-center border-2 border-gray-100"
                >
                  <div>
                    <h3 className="text-3xl font-black text-gray-800 mb-2">{quiz.title}</h3>
                    <p className="text-gray-500 font-bold">{quiz.questions.length} questions</p>
                  </div>
                  <button 
                    onClick={() => handleGenerateCode(quiz)}
                    className="tactile-btn px-8 py-4 bg-emerald-500 text-white font-black text-xl rounded-2xl shadow-[0_8px_0_0_#064e3b] hover:bg-emerald-400"
                  >
                    Host
                  </button>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

