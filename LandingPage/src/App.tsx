import { AiContext } from './sections/AiContext';
import { Customize } from './sections/Customize';
import { Engines } from './sections/Engines';
import { Faq } from './sections/Faq';
import { GetStarted } from './sections/GetStarted';
import { Hero } from './sections/Hero';
import { Platforms } from './sections/Platforms';
import { PopupTour } from './sections/PopupTour';
import { Privacy } from './sections/Privacy';
import { SiteHeader } from './sections/SiteHeader';

export function App() {
    return (
        <>
            <SiteHeader />
            <main>
                <Hero />
                <GetStarted />
                <PopupTour />
                <Customize />
                <AiContext />
                <Engines />
                <Platforms />
                <Privacy />
                <Faq />
            </main>
        </>
    );
}
