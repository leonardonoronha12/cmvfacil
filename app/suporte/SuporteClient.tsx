"use client";

import { useState } from "react";
import dash from "../dashboard/dashboard.module.css";
import styles from "./suporte.module.css";

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6 18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 7l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHeadset() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 12a7.5 7.5 0 0 1 15 0v6.25a1.75 1.75 0 0 1-1.75 1.75H16.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M4.5 12v5.25A1.75 1.75 0 0 0 6.25 19h.25"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M6.5 14.25H5.75A1.75 1.75 0 0 1 4 12.5v-1A1.75 1.75 0 0 1 5.75 9.75H6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17.5 14.25h.75A1.75 1.75 0 0 0 20 12.5v-1a1.75 1.75 0 0 0-1.75-1.75h-.75"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBook() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 4.5h9a2.5 2.5 0 0 1 2.5 2.5V19.5a2 2 0 0 0-2-2H7a2.5 2.5 0 0 0-2.5 2.5V7A2.5 2.5 0 0 1 7 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M8 8h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 11h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const SUPPORT_WA_URL =
  "https://api.whatsapp.com/send?phone=%205513936180830&text=Ol%C3%A1%2C+preciso+de+suporte+no+CMVF%C3%A1cil.";
const HELP_CENTER_URL = "https://cmv-facil.gitbook.io/cmv-facil";

export default function SuporteClient() {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <>
      <main className={dash.content}>
        <div className={dash.pageFrame}>
          {!isOpen ? (
            <div className={styles.pageCenter}>
              <button type="button" className={styles.openBtn} onClick={() => setIsOpen(true)}>
                Abrir suporte
              </button>
            </div>
          ) : null}
        </div>

        {isOpen ? (
          <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Suporte">
            <div className={styles.modalCard}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitle}>Como podemos te ajudar?</div>
                <button type="button" className={styles.modalClose} onClick={() => setIsOpen(false)} aria-label="Fechar">
                  <IconClose />
                </button>
              </div>

              <div className={styles.modalBody}>
                <a className={styles.optionCard} href={SUPPORT_WA_URL} target="_blank" rel="noreferrer">
                  <div className={styles.optionLeft}>
                    <span className={styles.optionIcon} aria-hidden>
                      <IconHeadset />
                    </span>
                    <div className={styles.optionText}>
                      <div className={styles.optionTitle}>Falar com Suporte</div>
                      <div className={styles.optionDesc}>Atendente humano para te ajudar com dúvidas ou problemas.</div>
                    </div>
                  </div>
                  <span className={styles.optionArrow} aria-hidden>
                    <IconArrowRight />
                  </span>
                </a>

                <a className={styles.optionCard} href={HELP_CENTER_URL} target="_blank" rel="noreferrer">
                  <div className={styles.optionLeft}>
                    <span className={styles.optionIcon} aria-hidden>
                      <IconBook />
                    </span>
                    <div className={styles.optionText}>
                      <div className={styles.optionTitle}>Central de Ajuda</div>
                      <div className={styles.optionDesc}>Guias e instruções para usar o CMV Fácil sem dificuldades.</div>
                    </div>
                  </div>
                  <span className={styles.optionArrow} aria-hidden>
                    <IconArrowRight />
                  </span>
                </a>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </>
  );
}
