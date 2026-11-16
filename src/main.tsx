import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';
import './multilingual.css';
import './background.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

import './seating/styles.css';
import './surfaces.css';
