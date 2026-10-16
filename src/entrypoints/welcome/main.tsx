import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configService } from '@/config/service';
import { WelcomeApp } from '@/ui/welcome/WelcomeApp';
import '@/ui/design/design.css';
import '@/ui/welcome/welcome.css';

void configService.syncLoggingLevel();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <WelcomeApp />
    </StrictMode>
);
