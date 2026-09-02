import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configService } from '@/config/service';
import { OptionsApp } from '@/ui/options/OptionsApp';
import '@/ui/options/options.css';

void configService.syncLoggingLevel();

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <OptionsApp />
    </StrictMode>
);
