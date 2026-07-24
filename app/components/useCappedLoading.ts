"use client";

import { useEffect, useRef, useState } from "react";

export default function useCappedLoading(
  isLoading: boolean,
  opts?: {
    delayMs?: number;
    maxMs?: number;
  },
) {
  const delayMs = typeof opts?.delayMs === "number" && opts.delayMs >= 0 ? opts.delayMs : 150;
  const maxMs = typeof opts?.maxMs === "number" && opts.maxMs > 0 ? opts.maxMs : 3000;

  const [show, setShow] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const timersRef = useRef<{ delay: any; max: any }>({ delay: null, max: null });

  useEffect(() => {
    return () => {
      if (timersRef.current.delay) clearTimeout(timersRef.current.delay);
      if (timersRef.current.max) clearTimeout(timersRef.current.max);
    };
  }, []);

  useEffect(() => {
    if (timersRef.current.delay) clearTimeout(timersRef.current.delay);
    if (timersRef.current.max) clearTimeout(timersRef.current.max);
    timersRef.current.delay = null;
    timersRef.current.max = null;

    if (!isLoading) {
      setShow(false);
      setTimedOut(false);
      return;
    }

    setTimedOut(false);
    timersRef.current.delay = setTimeout(() => setShow(true), delayMs);
    timersRef.current.max = setTimeout(() => {
      setShow(false);
      setTimedOut(true);
    }, maxMs);

    return () => {
      if (timersRef.current.delay) clearTimeout(timersRef.current.delay);
      if (timersRef.current.max) clearTimeout(timersRef.current.max);
      timersRef.current.delay = null;
      timersRef.current.max = null;
    };
  }, [delayMs, isLoading, maxMs]);

  return { show, timedOut };
}

