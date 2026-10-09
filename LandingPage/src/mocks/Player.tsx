import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import './Player.css';

/** A streaming player: the scene, its title, DualSub's lines and the controls. */
export function Player({
    className,
    scene,
    show,
    episode,
    subtitles,
    playing,
    played,
    buffered,
    time,
    children,
}: {
    className: string;
    scene: ReactNode;
    show: string;
    episode: string;
    subtitles: ReactNode;
    playing: boolean;
    /** Progress through the episode, in percent. */
    played: number;
    buffered: number;
    time: string;
    children?: ReactNode;
}) {
    return (
        <div className={`player ${className}`}>
            {scene}
            <div className="player-title">
                <Icon name="arrowLeft" />
                <strong>{show}</strong>
                <span>{episode}</span>
            </div>
            <div className="player-subtitles">{subtitles}</div>
            <div className="player-controls">
                <div className="player-progress">
                    <span
                        className="player-buffered"
                        style={{ width: `${buffered}%` }}
                    />
                    <span
                        className="player-played"
                        style={{ width: `${played}%` }}
                    />
                </div>
                <div className="player-buttons">
                    <Icon name={playing ? 'pause' : 'play'} />
                    <Icon name="rewind" className="player-seek" />
                    <Icon name="fastForward" className="player-seek" />
                    <Icon name="volume" />
                    <span className="player-time">{time}</span>
                    <Icon name="skipNext" className="player-push" />
                    <Icon name="captions" />
                    <Icon name="fullscreen" />
                </div>
            </div>
            {children}
        </div>
    );
}
