/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Home from './components/Home';
import AdminLogin from './components/AdminLogin';
import AdminDashboard from './components/AdminDashboard';
import CreateGame from './components/CreateGame';
import HostGame from './components/HostGame';
import JoinGame from './components/JoinGame';
import PlayerGame from './components/PlayerGame';

export type View = 'home' | 'admin-login' | 'admin-dashboard' | 'create-game' | 'host-game' | 'join-game' | 'player-game';

export default function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [sessionData, setSessionData] = useState<any>(null);

  const navigate = (view: View, data?: any) => {
    if (data) setSessionData(data);
    setCurrentView(view);
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans text-gray-900 flex flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div 
          key={currentView}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="flex-1 flex flex-col h-full"
        >
          {currentView === 'home' && <Home onNavigate={navigate} />}
          {currentView === 'admin-login' && <AdminLogin onNavigate={navigate} />}
          {currentView === 'admin-dashboard' && <AdminDashboard onNavigate={navigate} />}
          {currentView === 'create-game' && <CreateGame onNavigate={navigate} />}
          {currentView === 'host-game' && <HostGame onNavigate={navigate} sessionData={sessionData} />}
          {currentView === 'join-game' && <JoinGame onNavigate={navigate} />}
          {currentView === 'player-game' && <PlayerGame onNavigate={navigate} sessionData={sessionData} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}


