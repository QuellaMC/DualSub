import type { ReactNode } from 'react';
import { LogoMark } from '../components/Brand';
import { Icon } from '../components/Icon';
import './Browser.css';

/** A dark-theme Chrome window with DualSub in its toolbar; the tab shows a
 *  video by default. */
export function BrowserWindow({
    tabTitle,
    host,
    path,
    favicon = <Icon name="play" />,
    children,
}: {
    tabTitle: string;
    host: string;
    path: string;
    favicon?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="browser">
            <div className="browser-tabs">
                <span className="browser-lights">
                    <span />
                    <span />
                    <span />
                </span>
                <span className="browser-tab">
                    <span className="browser-favicon">{favicon}</span>
                    <span className="browser-tab-title">{tabTitle}</span>
                    <Icon name="close" className="browser-tab-close" />
                </span>
                <Icon name="plus" className="browser-new-tab" />
            </div>
            <div className="browser-toolbar">
                <Icon name="arrowLeft" />
                <Icon name="arrowRight" className="browser-disabled" />
                <Icon name="reload" />
                <span className="browser-omnibox">
                    <Icon name="lock" />
                    <span>
                        <span className="browser-host">{host}</span>
                        {path}
                    </span>
                </span>
                <Icon name="puzzle" />
                <span className="browser-extension">
                    <LogoMark />
                </span>
                <span className="browser-avatar">J</span>
            </div>
            <div className="browser-page">{children}</div>
        </div>
    );
}
