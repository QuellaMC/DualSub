import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configService } from '@/config/service';
import { PopupApp } from '@/ui/popup/PopupApp';
import '@/ui/popup/popup.css';

void configService.syncLoggingLevel();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PopupApp />
    </StrictMode>
);
