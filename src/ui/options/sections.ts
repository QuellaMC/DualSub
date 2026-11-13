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
        /** Takes the column beside it too, for the style editor's stage
         *  and the pane next to it. */
        readonly wide?: true;
        /** Holds settings a site can keep of its own, so the page can edit
         *  them for one site; elsewhere it edits what every site shares. */
        readonly scoped?: true;
    }
> = {
    start: { labelKey: 'navStart', icon: 'home', scoped: true },
    languages: { labelKey: 'navLanguages', icon: 'languages', scoped: true },
    look: { labelKey: 'navLook', icon: 'look', wide: true, scoped: true },
    timing: { labelKey: 'navTiming', icon: 'timing', scoped: true },
    translation: { labelKey: 'navTranslation', icon: 'translation' },
    explanations: { labelKey: 'navExplanations', icon: 'explain' },
    sites: { labelKey: 'navSites', icon: 'sites' },
    advanced: { labelKey: 'navAdvanced', icon: 'advanced', advanced: true },
    help: { labelKey: 'navHelp', icon: 'help' },
};

export function isSectionId(value: string): value is SectionId {
    return (SECTION_IDS as readonly string[]).includes(value);
}
