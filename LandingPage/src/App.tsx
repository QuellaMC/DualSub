import { ClosingCta } from './sections/ClosingCta';
import { Customize } from './sections/Customize';
import { Engines } from './sections/Engines';
import { Faq } from './sections/Faq';
import { GetStarted } from './sections/GetStarted';
import { Hero } from './sections/Hero';
import { Platforms } from './sections/Platforms';
import { PopupTour } from './sections/PopupTour';
import { Privacy } from './sections/Privacy';
import { SiteFooter } from './sections/SiteFooter';
import { SiteHeader } from './sections/SiteHeader';
import { WordLookup } from './sections/WordLookup';

export function App() {
    return (
        <>
            <SiteHeader />
            <main>
                <Hero />
                <GetStarted />
                <PopupTour />
                <Customize />
                <WordLookup />
                <Engines />
                <Platforms />
                <Privacy />
                <Faq />
                <ClosingCta />
            </main>
            <SiteFooter />
        </>
    );
}
