import React, { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Onboarding from './components/Onboarding/Onboarding';
import Settings from './components/Settings/Settings';
import CompanionWindow from './components/CompanionWindow/CompanionWindow';
import { useAppStore } from './stores/app-state';

declare global {
  interface Window {
    electronAPI?: {
      getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;
      getAppVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      on: (channel: string, callback: (...args: any[]) => void) => void;
      send: (channel: string, data: any) => void;
    };
  }
}

function MainApp() {
  const { isOnboardingComplete, initialize } = useAppStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (!isOnboardingComplete) {
    return <Onboarding />;
  }

  return (
    <div className="app">
      <Settings />
      <CompanionWindow />
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <MainApp />,
  },
  {
    path: '/companion',
    element: <CompanionWindow />,
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;

