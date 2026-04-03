import React, { useState } from 'react';
import { View } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { Info, X } from 'lucide-react';

export default function Home({ onNavigate }: { onNavigate: (view: View, data?: any) => void }) {
  const [showCredits, setShowCredits] = useState(false);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-kahoot text-white p-4 overflow-hidden relative">
      {/* Floating blobs */}
      <div className="absolute top-0 left-1/4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-2xl opacity-70 animate-blob"></div>
      <div className="absolute top-0 right-1/4 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-2xl opacity-70 animate-blob" style={{ animationDelay: '2s' }}></div>
      <div className="absolute -bottom-8 left-1/3 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-2xl opacity-70 animate-blob" style={{ animationDelay: '4s' }}></div>

      <motion.div 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.6, duration: 1 }}
        className="relative z-10 text-center"
      >
        <h1 className="text-7xl md:text-9xl font-black mb-12 tracking-tighter drop-shadow-2xl text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-300">
          QUIZ<span className="text-yellow-400">WIZ</span>
        </h1>
      </motion.div>

      <motion.div 
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', bounce: 0.5, delay: 0.2 }}
        className="space-y-6 w-full max-w-sm relative z-10"
      >
        <button 
          onClick={() => onNavigate('join-game')}
          className="tactile-btn w-full py-5 bg-white text-purple-700 font-black text-2xl rounded-2xl shadow-[0_8px_0_0_#cbd5e1] hover:bg-gray-50"
        >
          Join Game
        </button>
        <button 
          onClick={() => onNavigate('admin-login')}
          className="tactile-btn w-full py-5 bg-purple-900 text-white font-black text-2xl rounded-2xl shadow-[0_8px_0_0_#3b0764] hover:bg-purple-800"
        >
          Host / Admin
        </button>
        <button 
          onClick={() => setShowCredits(true)}
          className="tactile-btn w-full py-4 bg-purple-600 text-white font-black text-xl rounded-2xl shadow-[0_6px_0_0_#581c87] hover:bg-purple-500 flex items-center justify-center"
        >
          <Info className="w-6 h-6 mr-2" /> Credits
        </button>
      </motion.div>

      <AnimatePresence>
        {showCredits && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="bg-white text-gray-800 rounded-3xl shadow-2xl p-8 max-w-md w-full relative text-center"
            >
              <button onClick={() => setShowCredits(false)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-800">
                <X className="w-8 h-8" />
              </button>
              <h2 className="text-4xl font-black text-purple-700 mb-6">Credits</h2>
              <div className="space-y-4 text-lg font-medium">
                <p>Created by <span className="font-black text-gray-900">QuizWiz Team</span></p>
                <p>Inspired by Kahoot!</p>
                <p>Built with React, Tailwind CSS, and Supabase.</p>
                <p className="text-sm text-gray-500 mt-8 pt-8 border-t-2 border-gray-100">© 2026 QuizWiz. All rights reserved.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

