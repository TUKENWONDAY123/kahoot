import React, { useState } from 'react';
import { View } from '../App';
import { supabase } from '../supabaseClient';
import { Question } from '../types';
import { Plus, Save, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function CreateGame({ onNavigate }: { onNavigate: (view: View, data?: any) => void }) {
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<Question[]>([
    { id: '1', type: 'multiple-choice', question: '', answers: ['', '', '', ''], correctIndex: 0, sectionTag: '', imageUrl: '', explanation: '', correctAnswer: '' }
  ]);

  const addQuestion = () => {
    setQuestions([...questions, { id: Date.now().toString(), type: 'multiple-choice', question: '', answers: ['', '', '', ''], correctIndex: 0, sectionTag: '', imageUrl: '', explanation: '', correctAnswer: '' }]);
  };

  const updateQuestion = (index: number, field: keyof Question, value: any) => {
    const newQuestions = [...questions];
    newQuestions[index] = { ...newQuestions[index], [field]: value };
    setQuestions(newQuestions);
  };

  const updateAnswer = (qIndex: number, aIndex: number, value: string) => {
    const newQuestions = [...questions];
    newQuestions[qIndex].answers[aIndex] = value;
    setQuestions(newQuestions);
  };

  const removeQuestion = (index: number) => {
    if (questions.length > 1) {
      const newQuestions = [...questions];
      newQuestions.splice(index, 1);
      setQuestions(newQuestions);
    }
  };

  const handleSave = async () => {
    if (!title) return alert('Please enter a title');
    for (const q of questions) {
      if (!q.question || q.answers.some(a => !a)) return alert('Please fill all questions and answers');
    }

    const { error } = await supabase.from('quizzes').insert([{ title, questions }]);
    if (error) {
      alert('Error saving game. Check Supabase connection.');
    } else {
      onNavigate('admin-dashboard');
    }
  };

  const colors = [
    { bg: 'bg-rose-600' },
    { bg: 'bg-blue-600' },
    { bg: 'bg-amber-500' },
    { bg: 'bg-emerald-600' }
  ];

  return (
    <div className="flex-1 p-8 bg-gray-50 overflow-y-auto relative">
      <div className="absolute top-0 left-0 w-full h-96 bg-kahoot opacity-10 rounded-b-[100px] -z-10"></div>

      <div className="max-w-4xl mx-auto w-full relative z-10">
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex justify-between items-center mb-12"
        >
          <h1 className="text-5xl font-black text-gray-800 tracking-tight">Create Game</h1>
          <div className="space-x-4">
            <button onClick={() => onNavigate('admin-dashboard')} className="text-gray-500 hover:text-gray-800 font-bold">
              Cancel
            </button>
            <button 
              onClick={handleSave} 
              className="tactile-btn px-8 py-4 bg-emerald-500 text-white font-black text-xl rounded-2xl shadow-[0_8px_0_0_#064e3b] hover:bg-emerald-400 flex items-center"
            >
              <Save className="w-6 h-6 mr-2" /> Save Game
            </button>
          </div>
        </motion.div>

        <motion.div 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-3xl shadow-xl p-8 mb-12 border-2 border-gray-100"
        >
          <label className="block text-xl font-black text-gray-700 mb-4 uppercase tracking-widest">Game Title</label>
          <input 
            type="text" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-5 border-4 border-gray-200 rounded-2xl text-2xl font-bold focus:ring-0 focus:border-purple-600 outline-none transition-colors"
            placeholder="Enter Kahoot Title..."
          />
        </motion.div>

        <div className="space-y-12">
          <AnimatePresence>
            {questions.map((q, qIndex) => (
              <motion.div 
                key={q.id} 
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-white rounded-3xl shadow-xl p-8 relative border-2 border-gray-100"
              >
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-2xl font-black text-gray-400">Question {qIndex + 1}</h3>
                  <div className="flex items-center space-x-4">
                    <select 
                      value={q.type || 'multiple-choice'} 
                      onChange={(e) => updateQuestion(qIndex, 'type', e.target.value)}
                      className="p-2 border-2 border-gray-200 rounded-xl font-bold focus:outline-none focus:border-purple-600"
                    >
                      <option value="multiple-choice">Multiple Choice</option>
                      <option value="free-response">Free Response</option>
                    </select>
                    {questions.length > 1 && (
                      <button onClick={() => removeQuestion(qIndex)} className="text-red-400 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50">
                        <Trash2 className="w-6 h-6" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <input 
                    type="text" 
                    value={q.sectionTag || ''}
                    onChange={(e) => updateQuestion(qIndex, 'sectionTag', e.target.value)}
                    className="w-full p-3 border-4 border-gray-200 rounded-2xl font-bold focus:ring-0 focus:border-purple-600 outline-none transition-colors"
                    placeholder="Section Tag (e.g. Functions)"
                  />
                  <input 
                    type="text" 
                    value={q.imageUrl || ''}
                    onChange={(e) => updateQuestion(qIndex, 'imageUrl', e.target.value)}
                    className="w-full p-3 border-4 border-gray-200 rounded-2xl font-bold focus:ring-0 focus:border-purple-600 outline-none transition-colors"
                    placeholder="Image URL (optional)"
                  />
                </div>

                <input 
                  type="text" 
                  value={q.question}
                  onChange={(e) => updateQuestion(qIndex, 'question', e.target.value)}
                  className="w-full p-6 border-4 border-gray-200 rounded-2xl mb-4 text-3xl font-black focus:ring-0 focus:border-purple-600 outline-none text-center transition-colors shadow-inner"
                  placeholder="Start typing your question"
                />

                {q.type === 'free-response' ? (
                  <div className="mb-8">
                    <input 
                      type="text" 
                      value={q.correctAnswer || ''}
                      onChange={(e) => updateQuestion(qIndex, 'correctAnswer', e.target.value)}
                      className="w-full p-6 border-4 border-emerald-200 bg-emerald-50 rounded-2xl text-2xl font-bold focus:ring-0 focus:border-emerald-500 outline-none text-center transition-colors"
                      placeholder="Type the correct answer here"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-6 mb-8">
                    {q.answers.map((ans, aIndex) => (
                      <div key={aIndex} className="relative flex items-center group">
                        <div className={`absolute left-0 top-0 bottom-0 w-16 flex items-center justify-center rounded-l-2xl ${colors[aIndex].bg} transition-transform group-focus-within:scale-105 origin-left`}>
                          <div 
                            className={`w-8 h-8 rounded-full border-4 border-white cursor-pointer transition-all ${q.correctIndex === aIndex ? 'bg-white scale-110' : 'bg-transparent hover:bg-white/30'}`} 
                            onClick={() => updateQuestion(qIndex, 'correctIndex', aIndex)}
                          >
                            {q.correctIndex === aIndex && <div className="w-full h-full flex items-center justify-center text-black text-lg font-black">✓</div>}
                          </div>
                        </div>
                        <input 
                          type="text" 
                          value={ans}
                          onChange={(e) => updateAnswer(qIndex, aIndex, e.target.value)}
                          className={`w-full p-6 pl-20 border-4 border-gray-200 rounded-2xl text-xl font-bold focus:ring-0 focus:border-gray-400 outline-none transition-all ${q.correctIndex === aIndex ? 'bg-green-50 border-green-200' : ''}`}
                          placeholder={`Add answer ${aIndex + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <input 
                  type="text" 
                  value={q.explanation || ''}
                  onChange={(e) => updateQuestion(qIndex, 'explanation', e.target.value)}
                  className="w-full p-4 border-4 border-amber-100 bg-amber-50 rounded-2xl font-bold focus:ring-0 focus:border-amber-400 outline-none transition-colors"
                  placeholder="Explanation (shown after answering)"
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <motion.button 
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={addQuestion} 
          className="mt-12 w-full py-8 border-4 border-dashed border-gray-300 text-gray-500 font-black text-2xl rounded-3xl hover:bg-white hover:border-purple-400 hover:text-purple-600 transition-all flex items-center justify-center"
        >
          <Plus className="w-8 h-8 mr-3" /> Add Question
        </motion.button>
      </div>
    </div>
  );
}

