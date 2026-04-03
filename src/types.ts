export interface Question {
  id: string;
  type?: 'multiple-choice' | 'free-response';
  question: string;
  answers: string[];
  correctIndex: number;
  correctAnswer?: string;
  explanation?: string;
  imageUrl?: string;
  sectionTag?: string;
}

export interface Quiz {
  id: string;
  title: string;
  questions: Question[];
  created_at: string;
}

export interface GameSession {
  id: string;
  quiz_id: string;
  pin: string;
  status: 'waiting' | 'question' | 'leaderboard' | 'finished';
  current_question_index: number;
  created_at: string;
}

export interface Player {
  id: string;
  session_id: string;
  name: string;
  score: number;
  last_answer_correct: boolean;
}
