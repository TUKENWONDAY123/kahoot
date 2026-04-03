import React, { useEffect, useState } from 'react';
import { View } from '../App';
import { supabase } from '../supabaseClient';
import { GameSession, Player, Quiz } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

export default function HostGame({ onNavigate, sessionData }: { onNavigate: (view: View, data?: any) => void, sessionData: any }) {
  const [session, setSession] = useState<GameSession | null>(sessionData?.session || null);
  const [quiz, setQuiz] = useState<Quiz | null>(sessionData?.quiz || null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportText, setReportText] = useState('');

  useEffect(() => {
    if (!session) return;

    // Subscribe to players joining
    const playerSub = supabase.channel(`players:${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${session.id}` }, payload => {
        if (payload.eventType === 'INSERT') {
          setPlayers(prev => [...prev, payload.new as Player]);
        } else if (payload.eventType === 'UPDATE') {
          setPlayers(prev => prev.map(p => p.id === payload.new.id ? payload.new as Player : p));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(playerSub);
    };
  }, [session]);

  const startGame = async () => {
    if (!session) return;
    const { data, error } = await supabase.from('game_sessions')
      .update({ status: 'question', current_question_index: 0 })
      .eq('id', session.id)
      .select().single();
    if (data) setSession(data);
  };

  const nextState = async () => {
    if (!session || !quiz) return;
    
    let newStatus = session.status;
    let newIndex = session.current_question_index;

    if (session.status === 'question') {
      newStatus = 'leaderboard';
    } else if (session.status === 'leaderboard') {
      if (session.current_question_index < quiz.questions.length - 1) {
        newStatus = 'question';
        newIndex++;
      } else {
        newStatus = 'finished';
      }
    }

    const { data } = await supabase.from('game_sessions')
      .update({ status: newStatus, current_question_index: newIndex })
      .eq('id', session.id)
      .select().single();
    
    if (data) setSession(data);
  };

  if (!session || !quiz) return <div>Error loading session</div>;

  const currentQuestion = quiz.questions[session.current_question_index];

  const colors = [
    { bg: 'bg-rose-600', shadow: 'shadow-[0_8px_0_0_#9f1239]' },
    { bg: 'bg-blue-600', shadow: 'shadow-[0_8px_0_0_#1e3a8a]' },
    { bg: 'bg-amber-500', shadow: 'shadow-[0_8px_0_0_#b45309]' },
    { bg: 'bg-emerald-600', shadow: 'shadow-[0_8px_0_0_#064e3b]' }
  ];

  return (
    <div className="flex-1 flex flex-col bg-gray-100 overflow-hidden">
      <AnimatePresence mode="wait">
        {session.status === 'waiting' && (
          <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-kahoot text-white relative">
            {/* Blobs */}
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
            
            <motion.div initial={{ y: -50 }} animate={{ y: 0 }} className="relative z-10 mb-12">
              <h1 className="text-5xl font-bold mb-6">Join at <span className="text-yellow-400 font-black">quizwiz.app</span></h1>
              <div className="bg-white text-black px-16 py-8 rounded-3xl shadow-[0_12px_0_0_rgba(0,0,0,0.2)]">
                <p className="text-2xl font-bold text-gray-500 mb-2 uppercase tracking-widest">Game PIN</p>
                <h2 className="text-8xl md:text-9xl font-black tracking-widest">{session.pin}</h2>
              </div>
            </motion.div>
            
            <div className="w-full max-w-6xl bg-white/10 backdrop-blur-md rounded-3xl shadow-2xl p-8 min-h-[400px] relative z-10 border border-white/20">
              <div className="flex justify-between items-center mb-8 border-b border-white/20 pb-6">
                <h3 className="text-4xl font-black">{players.length} Players</h3>
                <button onClick={startGame} className="tactile-btn px-10 py-4 bg-emerald-500 text-white font-black text-2xl rounded-2xl shadow-[0_8px_0_0_#064e3b] hover:bg-emerald-400">
                  Start Game
                </button>
              </div>
              <div className="flex flex-wrap gap-4">
                <AnimatePresence>
                  {players.map(p => (
                    <motion.div 
                      key={p.id} 
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="px-6 py-3 bg-white text-purple-900 rounded-xl font-black text-2xl shadow-lg"
                    >
                      {p.name}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}

        {session.status === 'question' && (
          <motion.div key="question" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col p-8 bg-gray-50">
            <div className="w-full max-w-6xl mx-auto mb-8">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-500 font-bold text-xl">Question {session.current_question_index + 1} of {quiz.questions.length}</span>
                <span className="text-gray-500 font-bold text-xl">{Math.round(((session.current_question_index + 1) / quiz.questions.length) * 100)}%</span>
              </div>
              <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${((session.current_question_index + 1) / quiz.questions.length) * 100}%` }}
                  className="h-full bg-purple-600 rounded-full"
                />
              </div>
            </div>

            <div className="text-center mb-8 mt-4">
              {currentQuestion.sectionTag && (
                <motion.div 
                  initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                  className="inline-block px-6 py-2 bg-purple-100 text-purple-800 font-bold rounded-full mb-6 text-xl tracking-widest uppercase"
                >
                  {currentQuestion.sectionTag}
                </motion.div>
              )}
              <motion.h2 
                initial={{ scale: 0.8, opacity: 0 }} 
                animate={{ scale: 1, opacity: 1 }} 
                transition={{ type: 'spring', bounce: 0.5 }}
                className="text-4xl md:text-5xl font-black bg-white inline-block px-12 py-8 rounded-3xl shadow-[0_8px_0_0_rgba(0,0,0,0.1)] text-gray-800"
                dangerouslySetInnerHTML={{ __html: currentQuestion.question }}
              />
            </div>
            
            {currentQuestion.imageUrl && (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex justify-center mb-8">
                <img src={currentQuestion.imageUrl} alt="Question" className="max-h-64 rounded-2xl shadow-lg border-4 border-white" />
              </motion.div>
            )}

            <div className="flex-1"></div>

            {currentQuestion.type === 'free-response' ? (
              <div className="flex justify-center items-center h-48">
                <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="text-4xl font-black text-gray-400">
                  Players are typing their answers...
                </motion.div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6 max-w-6xl mx-auto w-full">
                {currentQuestion.answers.map((ans, i) => (
                  <motion.div 
                    key={i} 
                    initial={{ x: i % 2 === 0 ? -50 : 50, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: i * 0.1, type: 'spring' }}
                    className={`p-10 text-white text-3xl font-black rounded-3xl flex items-center justify-center text-center ${colors[i].bg} ${colors[i].shadow}`}
                    dangerouslySetInnerHTML={{ __html: ans }}
                  />
                ))}
              </div>
            )}

            <div className="flex justify-between items-center mt-12 max-w-6xl mx-auto w-full">
              <button onClick={() => setShowReportModal(true)} className="flex items-center text-gray-500 hover:text-rose-500 font-bold transition-colors">
                <AlertTriangle className="w-6 h-6 mr-2" /> Report Issue
              </button>
              <button onClick={nextState} className="tactile-btn px-10 py-4 bg-gray-800 text-white font-black text-xl rounded-2xl shadow-[0_8px_0_0_#000] hover:bg-gray-700">
                Skip / Show Leaderboard
              </button>
            </div>
          </motion.div>
        )}

        {session.status === 'leaderboard' && (
          <motion.div key="leaderboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col items-center justify-center p-8 bg-kahoot text-white overflow-y-auto">
            <h2 className="text-6xl font-black mb-8 drop-shadow-lg">Leaderboard</h2>
            
            {(currentQuestion.explanation || currentQuestion.type === 'free-response') && (
              <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="w-full max-w-3xl bg-white/20 backdrop-blur-md rounded-3xl p-6 mb-8 border border-white/30 text-center">
                <h3 className="text-2xl font-bold text-yellow-300 mb-2">Correct Answer:</h3>
                <p className="text-3xl font-black mb-4" dangerouslySetInnerHTML={{ __html: currentQuestion.type === 'free-response' ? (currentQuestion.correctAnswer || '') : currentQuestion.answers[currentQuestion.correctIndex] }} />
                {currentQuestion.explanation && (
                  <>
                    <h3 className="text-xl font-bold text-emerald-300 mb-2">Explanation:</h3>
                    <p className="text-xl font-medium" dangerouslySetInnerHTML={{ __html: currentQuestion.explanation }} />
                  </>
                )}
              </motion.div>
            )}

            <div className="w-full max-w-3xl bg-white/10 backdrop-blur-md rounded-3xl shadow-2xl p-8 border border-white/20">
              {players.sort((a, b) => b.score - a.score).slice(0, 5).map((p, i) => (
                <motion.div 
                  key={p.id} 
                  initial={{ x: -50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex justify-between items-center py-6 border-b border-white/20 last:border-0"
                >
                  <div className="flex items-center">
                    <span className="text-3xl font-black mr-6 w-12 text-yellow-400">{i + 1}.</span>
                    <span className="text-3xl font-bold">{p.name}</span>
                  </div>
                  <span className="text-4xl font-black">{p.score}</span>
                </motion.div>
              ))}
            </div>
            <button onClick={nextState} className="tactile-btn mt-12 px-12 py-5 bg-white text-purple-700 font-black text-2xl rounded-2xl shadow-[0_8px_0_0_#cbd5e1] hover:bg-gray-100">
              Next
            </button>
          </motion.div>
        )}

        {session.status === 'finished' && (
          <motion.div key="finished" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col items-center justify-center p-8 bg-kahoot text-white overflow-hidden relative">
            <h2 className="text-7xl font-black mb-16 text-yellow-400 drop-shadow-2xl">Podium</h2>
            <div className="flex items-end justify-center gap-6 h-96 mb-16 w-full max-w-4xl">
              {players.sort((a, b) => b.score - a.score).slice(0, 3).map((p, i) => (
                <motion.div 
                  key={p.id} 
                  initial={{ y: 200, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: i === 0 ? 0.6 : i === 1 ? 0.3 : 0, type: 'spring', bounce: 0.4 }}
                  className="flex flex-col items-center w-1/3" 
                  style={{ order: i === 0 ? 2 : i === 1 ? 1 : 3 }}
                >
                  <span className="text-3xl font-black mb-2 truncate w-full text-center">{p.name}</span>
                  <span className="text-2xl font-bold mb-4 opacity-80">{p.score}</span>
                  <div className={`w-full flex items-start justify-center pt-6 text-white font-black text-6xl rounded-t-2xl shadow-[inset_0_-8px_0_0_rgba(0,0,0,0.2)] ${
                    i === 0 ? 'h-72 bg-yellow-400' : i === 1 ? 'h-56 bg-gray-300' : 'h-40 bg-orange-500'
                  }`}>
                    {i + 1}
                  </div>
                </motion.div>
              ))}
            </div>
            <button onClick={() => onNavigate('admin-dashboard')} className="tactile-btn px-10 py-4 bg-white/20 backdrop-blur-sm border border-white/30 text-white font-black text-xl rounded-2xl hover:bg-white/30">
              Back to Dashboard
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReportModal && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl p-8 max-w-lg w-full relative"
            >
              <button onClick={() => setShowReportModal(false)} className="absolute top-6 right-6 text-gray-400 hover:text-gray-800">
                <X className="w-8 h-8" />
              </button>
              <h2 className="text-3xl font-black text-gray-800 mb-6 flex items-center">
                <AlertTriangle className="w-8 h-8 text-rose-500 mr-3" /> Report Issue
              </h2>
              <p className="text-gray-600 font-medium mb-6">
                Found a mistake in this question? Let us know what's wrong.
              </p>
              <textarea 
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                className="w-full p-4 border-4 border-gray-200 rounded-2xl mb-6 font-medium focus:outline-none focus:border-purple-500 min-h-[120px] resize-none"
                placeholder="Describe the issue (e.g. wrong answer, typo, broken image)..."
              />
              <div className="flex justify-end space-x-4">
                <button onClick={() => setShowReportModal(false)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl">
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    alert('Issue reported! Thank you.');
                    setShowReportModal(false);
                    setReportText('');
                  }} 
                  className="tactile-btn px-8 py-3 bg-rose-500 text-white font-black rounded-xl shadow-[0_6px_0_0_#be123c] hover:bg-rose-400"
                >
                  Submit Report
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

