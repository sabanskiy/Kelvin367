// "About & data" sheet. Holds the NASA FIRMS acknowledgement that DATA.md requires in the application.
import { useEffect, useRef } from 'react';
import { Icon } from './Icon';
import { useI18n } from '../i18n';

/** Required verbatim by the FIRMS terms; kept in English in both languages. */
export const FIRMS_ACKNOWLEDGEMENT =
  'We acknowledge the use of data and/or imagery from NASA\'s Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA\'s Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA\'s Earth Science Data and Information System (ESDIS). The data are provided "as is"; users bear all responsibility for their use.';

export function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="about-sheet"
      aria-labelledby="about-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop click
      }}
    >
      <div className="about-inner">
        <div className="about-head">
          <h2 id="about-title">{t('about.title')}</h2>
          <button type="button" className="close-panel" onClick={onClose} aria-label={t('about.close')}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <p className="about-lead">{t('about.lead')}</p>
        <ul>
          <li>{t('about.history')}</li>
          <li>{t('about.forecast')}</li>
          <li>{t('about.detections')}</li>
          <li>{t('about.ukraine')}</li>
        </ul>
        <h3>{t('about.ackTitle')}</h3>
        <p className="ack" lang="en">
          {FIRMS_ACKNOWLEDGEMENT}
        </p>
        <p className="muted small">{t('about.project')}</p>
      </div>
    </dialog>
  );
}
