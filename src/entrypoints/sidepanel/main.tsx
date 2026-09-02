import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configService } from '@/config/service';
import { SidePanelApp } from '@/ui/sidepanel/SidePanelApp';
import '@/ui/sidepanel/sidepanel.css';

void configService.syncLoggingLevel();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <SidePanelApp />
    </StrictMode>
);
