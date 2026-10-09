import { Hero } from './sections/Hero';
import { SiteHeader } from './sections/SiteHeader';

export function App() {
    return (
        <>
            <SiteHeader />
            <main>
                <Hero />
            </main>
        </>
    );
}
