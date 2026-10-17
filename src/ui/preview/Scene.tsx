/** The picture behind sample subtitles, filling the frame it is in. */
export function Scene({ day = false }: { day?: boolean }) {
    return (
        <span className={day ? 'scene day' : 'scene'} aria-hidden="true">
            <span className="scene-orb" />
            <span className="scene-hill" />
            <span className="scene-hill far" />
        </span>
    );
}
