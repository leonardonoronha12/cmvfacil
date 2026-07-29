"use client";

import { useEffect } from "react";

export default function ResetPasswordAliasPage() {
  useEffect(() => {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    window.location.replace(`/restaurar-senha${search}${hash}`);
  }, []);

  return null;
}
