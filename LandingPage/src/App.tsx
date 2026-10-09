import { Customize } from './sections/Customize';
import { GetStarted } from './sections/GetStarted';
import { Hero } from './sections/Hero';
import { PopupTour } from './sections/PopupTour';
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
            </main>
        </>
    );
}
