"use client";

import React from "react";

interface SplitPromptProps {
  durationSec: number;
  onSplit: () => void;
  onContinue: () => void;
}

export default function SplitPrompt({
  durationSec,
  onSplit,
  onContinue,
}: SplitPromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1d23] border border-indigo-500/30 rounded-xl shadow-2xl shadow-indigo-500/10 p-6 w-full max-w-sm text-center">
        <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
          <svg
            className="w-5 h-5 text-amber-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h3 className="text-sm font-semibold text-white mb-2">
          Segment at {durationSec.toFixed(1)}s
        </h3>
        <p className="text-xs text-slate-300 mb-5 leading-relaxed">
          The current segment has reached 15 seconds — the maximum allowed
          duration. This segment has been saved. Continue marking the next
          segment with the same intent.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg uppercase tracking-wider transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
