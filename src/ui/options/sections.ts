import type { IconName } from '../design/Icon';

export const SECTION_IDS = [
    'start',
    'languages',
    'look',
    'timing',
    'translation',
    'explanations',
    'sites',
    'advanced',
    'help',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export const SECTIONS: Record<
    SectionId,
    {
        readonly labelKey: string;
        readonly icon: IconName;
        /** Shown only with the advanced options. */
        readonly advanced?: true;
        /** Shows the live subtitle preview beside it. */
        readonly preview?: true;
        /** Holds settings a site can keep of its own, so the page can edit
         *  them for one site; elsewhere it edits what every site shares. */
        readonly scoped?: true;
    }
> = {
    start: { labelKey: 'navStart', icon: 'home', preview: true, scoped: true },
    languages: {
        labelKey: 'navLanguages',
        icon: 'languages',
        preview: true,
        scoped: true,
    },
    look: { labelKey: 'navLook', icon: 'look', preview: true, scoped: true },
    timing: {
        labelKey: 'navTiming',
        icon: 'timing',
        preview: true,
        scoped: true,
    },
    translation: { labelKey: 'navTranslation', icon: 'translation' },
    explanations: { labelKey: 'navExplanations', icon: 'explain' },
    sites: { labelKey: 'navSites', icon: 'sites' },
    advanced: { labelKey: 'navAdvanced', icon: 'advanced', advanced: true },
    help: { labelKey: 'navHelp', icon: 'help' },
};

export function isSectionId(value: string): value is SectionId {
    return (SECTION_IDS as readonly string[]).includes(value);
}
