import React, { useEffect, useState } from 'react';
import { View } from '../App';
import { supabase } from '../supabaseClient';
import { GameSession, Player, Quiz } from '../types';
import { motion, AnimatePresence } from 'motion/react';

export default function PlayerGame({ onNavigate, sessionData }: { onNavigate: (view: View, data?: any) => void, sessionData: any }) {
  const [session, setSession] = useState<GameSession | null>(sessionData?.session || null);
  const [player, setPlayer] = useState<Player | null>(sessionData?.player || null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [answered, setAnswered] = useState(false);
  const [freeResponseAnswer, setFreeResponseAnswer] = useState('');

  useEffect(() => {
    if (!session) return;

    const fetchQuiz = async () => {
      const { data } = await supabase.from('quizzes').select('*').eq('id', session.quiz_id).single();
      if (data) setQuiz(data);
    };
    fetchQuiz();

    // Subscribe to session changes
    const sessionSub = supabase.channel(`session:${session.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_sessions', filter: `id=eq.${session.id}` }, payload => {
        const newSession = payload.new as GameSession;
        setSession(newSession);
        if (newSession.status === 'question') {
          setAnswered(false);
          setFreeResponseAnswer('');
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(sessionSub);
    };
  }, [session]);

  const handleAnswer = async (indexOrText: number | string) => {
    if (answered || !session || !player || !quiz) return;
    setAnswered(true);

    const currentQ = quiz.questions[session.current_question_index];
    let isCorrect = false;

    if (currentQ.type === 'free-response') {
      // Simple string matching for free response
      isCorrect = String(indexOrText).trim().toLowerCase() === String(currentQ.correctAnswer || '').trim().toLowerCase();
    } else {
      isCorrect = currentQ.correctIndex === indexOrText;
    }
    
    if (isCorrect) {
      const newScore = player.score + 1000; // Simple scoring
      await supabase.from('players').update({ score: newScore, last_answer_correct: true }).eq('id', player.id);
      setPlayer({ ...player, score: newScore, last_answer_correct: true });
    } else {
      await supabase.from('players').update({ last_answer_correct: false }).eq('id', player.id);
      setPlayer({ ...player, last_answer_correct: false });
    }
  };

  if (!session || !player) return <div>Error loading game</div>;

  const colors = [
    { bg: 'bg-rose-600', shadow: 'shadow-[0_12px_0_0_#9f1239]' },
    { bg: 'bg-blue-600', shadow: 'shadow-[0_12px_0_0_#1e3a8a]' },
    { bg: 'bg-amber-500', shadow: 'shadow-[0_12px_0_0_#b45309]' },
    { bg: 'bg-emerald-600', shadow: 'shadow-[0_12px_0_0_#064e3b]' }
  ];

  return (
    <div className="flex-1 flex flex-col bg-gray-100 overflow-hidden">
      <AnimatePresence mode="wait">
        {session.status === 'waiting' && (
          <motion.div key="waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex items-center justify-center bg-kahoot text-white p-8 text-center">
            <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
              <h1 className="text-5xl md:text-7xl font-black mb-4">You're in!</h1>
              <p className="text-2xl md:text-3xl font-bold opacity-80">See your nickname on screen</p>
            </motion.div>
          </motion.div>
        )}

        {session.status === 'question' && (
          <motion.div key="question" initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }} className="flex-1 flex flex-col p-4 bg-gray-100">
            {answered ? (
              <div className="flex-1 flex items-center justify-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="text-4xl font-black text-gray-400 animate-pulse">
                  Waiting for others...
                </motion.div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-4">
                {quiz?.questions[session.current_question_index]?.type === 'free-response' ? (
                  <div className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-xl">
                    <h3 className="text-3xl font-black text-gray-800 mb-6 text-center">Type your answer</h3>
                    <input 
                      type="text" 
                      value={freeResponseAnswer}
                      onChange={(e) => setFreeResponseAnswer(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAnswer(freeResponseAnswer)}
                      className="w-full p-6 border-4 border-gray-200 rounded-2xl text-3xl font-bold focus:ring-0 focus:border-purple-600 outline-none text-center transition-colors mb-6"
                      placeholder="Your answer..."
                      autoFocus
                    />
                    <button 
                      onClick={() => handleAnswer(freeResponseAnswer)}
                      className="w-full tactile-btn py-6 bg-purple-600 text-white font-black text-2xl rounded-2xl shadow-[0_8px_0_0_#581c87] hover:bg-purple-500"
                    >
                      Submit
                    </button>
                  </div>
                ) : (
                  <div className="w-full grid grid-cols-2 gap-4 md:gap-8 h-full max-h-[600px]">
                    {[0, 1, 2, 3].map((i) => (
                      <motion.button 
                        key={i}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: i * 0.1, type: 'spring', bounce: 0.5 }}
                        onClick={() => handleAnswer(i)}
                        className={`tactile-btn rounded-2xl ${colors[i].bg} ${colors[i].shadow} w-full h-full min-h-[150px]`}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {session.status === 'leaderboard' && (
          <motion.div key="leaderboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`flex-1 flex flex-col items-center justify-center p-8 text-center text-white overflow-y-auto ${player.last_answer_correct ? 'bg-emerald-500' : 'bg-rose-600'}`}>
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', bounce: 0.6 }} className="mb-12">
              <h1 className="text-7xl md:text-9xl font-black mb-6 drop-shadow-lg">{player.last_answer_correct ? 'Correct!' : 'Incorrect'}</h1>
              <div className="inline-block bg-black/20 px-8 py-4 rounded-3xl backdrop-blur-sm">
                <p className="text-3xl font-bold">Score: {player.score}</p>
              </div>
            </motion.div>

            {quiz && (quiz.questions[session.current_question_index].explanation || quiz.questions[session.current_question_index].type === 'free-response') && (
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }} className="w-full max-w-2xl bg-white/20 backdrop-blur-md rounded-3xl p-8 border border-white/30 text-left">
                <h3 className="text-2xl font-bold text-yellow-300 mb-2">Correct Answer:</h3>
                <p className="text-3xl font-black mb-6" dangerouslySetInnerHTML={{ __html: quiz.questions[session.current_question_index].type === 'free-response' ? (quiz.questions[session.current_question_index].correctAnswer || '') : quiz.questions[session.current_question_index].answers[quiz.questions[session.current_question_index].correctIndex] }} />
                
                {quiz.questions[session.current_question_index].explanation && (
                  <>
                    <h3 className="text-xl font-bold text-white mb-2">Explanation:</h3>
                    <p className="text-xl font-medium" dangerouslySetInnerHTML={{ __html: quiz.questions[session.current_question_index].explanation || '' }} />
                  </>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {session.status === 'finished' && (
          <motion.div key="finished" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex items-center justify-center bg-kahoot text-white p-8 text-center">
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring' }}>
              <h1 className="text-6xl md:text-8xl font-black mb-6">Game Over!</h1>
              <p className="text-4xl font-bold mb-12 text-yellow-400">Final Score: {player.score}</p>
              <button onClick={() => onNavigate('home')} className="tactile-btn px-12 py-6 bg-white text-purple-700 font-black text-3xl rounded-2xl shadow-[0_8px_0_0_#cbd5e1]">
                Play Again
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

