import { LogoMark } from '../components/Brand';
import { Icon } from '../components/Icon';
import { Cursor } from '../mocks/Cursor';
import { PopupMock } from '../mocks/Popup';
import { NightCityScene } from '../mocks/scenes';
import './StepArt.css';

/** Chrome's puzzle-piece menu, about to pin DualSub to the toolbar. */
export function PinExtensionArt() {
    return (
        <div className="pin-art">
            <div className="pin-toolbar">
                <span className="pin-omnibox">
                    <Icon name="lock" />
                    netflix.com
                </span>
                <span className="pin-puzzle">
                    <Icon name="puzzle" />
                </span>
                <LogoMark className="pin-pinned" />
                <span className="pin-avatar" />
            </div>
            <div className="pin-menu">
                <div className="pin-menu-head">
                    <strong>Extensions</strong>
                    <Icon name="close" />
                </div>
                <span className="pin-menu-label">Full access</span>
                <div className="pin-menu-row pin-menu-row-active">
                    <LogoMark className="pin-menu-icon" />
                    <span className="pin-menu-name">DualSub</span>
                    <span className="pin-menu-pin pin-menu-pin-on">
                        <Icon name="pin" />
                    </span>
                    <Icon name="menu" className="pin-menu-grip" />
                </div>
                <div className="pin-menu-row">
                    <span className="pin-menu-icon pin-menu-blank" />
                    <span className="pin-menu-name">Another extension</span>
                    <span className="pin-menu-pin">
                        <Icon name="pin" />
                    </span>
                    <Icon name="menu" className="pin-menu-grip" />
                </div>
                <div className="pin-menu-manage">
                    <Icon name="sliders" />
                    Manage extensions
                </div>
            </div>
            <Cursor className="pin-cursor" />
        </div>
    );
}

/** The player's subtitle menu with English being switched on. */
export function SubtitleMenuArt() {
    return (
        <div className="menu-art">
            <NightCityScene />
            <div className="menu-art-menu">
                <span className="menu-art-title">
                    <Icon name="captions" />
                    Subtitles
                </span>
                <span className="menu-art-option">Off</span>
                <span className="menu-art-option menu-art-option-on">
                    <Icon name="check" />
                    English
                </span>
                <span className="menu-art-option" lang="es">
                    Español
                </span>
                <span className="menu-art-option" lang="fr">
                    Français
                </span>
            </div>
            <Cursor className="menu-art-cursor" />
            <div className="menu-art-bar">
                <Icon name="play" />
                <span className="menu-art-track">
                    <span />
                </span>
            </div>
        </div>
    );
}

/** The popup with the switch and the language to turn on outlined. */
export function ChooseLanguagesArt() {
    return (
        <div className="languages-art">
            <PopupMock
                className="languages-art-popup"
                highlighted={['enable', 'translateTo']}
            />
        </div>
    );
}
