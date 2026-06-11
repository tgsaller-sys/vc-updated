import { motion } from "framer-motion";
import type { Card } from "@vc/game";
import "./cards.css";

const redSuits: readonly Card["suit"][] = ["diamonds", "hearts"];

export interface CardViewProps {
  readonly card: Card;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: (card: Card) => void;
}

interface SuitGlyphProps {
  readonly suit: Card["suit"];
  readonly size: "corner" | "center";
}

function SwordGlyph() {
  return (
    <>
      <path className="vc-card-glyph-metal" d="M60 18 L68 72 L60 94 L52 72 Z" />
      <path className="vc-card-glyph-line" d="M60 24 L60 88" />
      <path className="vc-card-glyph-line" d="M42 88 L78 88" />
      <path className="vc-card-glyph-metal" d="M54 94 L66 94 L64 118 L56 118 Z" />
      <path className="vc-card-glyph-accent" d="M50 122 L70 122 L65 134 L55 134 Z" />
    </>
  );
}

function MorningstarGlyph() {
  return (
    <>
      <path className="vc-card-glyph-line" d="M45 116 L78 52" />
      <path className="vc-card-glyph-metal" d="M38 108 L51 114 L45 130 L32 124 Z" />
      <circle className="vc-card-glyph-metal" cx="82" cy="45" r="18" />
      <path className="vc-card-glyph-metal" d="M82 15 L87 29 L77 29 Z" />
      <path className="vc-card-glyph-metal" d="M82 75 L77 61 L87 61 Z" />
      <path className="vc-card-glyph-metal" d="M52 45 L66 40 L66 50 Z" />
      <path className="vc-card-glyph-metal" d="M112 45 L98 50 L98 40 Z" />
      <path className="vc-card-glyph-line" d="M73 36 L91 54" />
      <path className="vc-card-glyph-line" d="M91 36 L73 54" />
    </>
  );
}

function RubyGlyph() {
  return (
    <>
      <path className="vc-card-glyph-accent" d="M60 20 L92 50 L60 134 L28 50 Z" />
      <path className="vc-card-glyph-highlight" d="M60 20 L74 50 L60 134 L46 50 Z" />
      <path className="vc-card-glyph-line" d="M28 50 H92" />
      <path className="vc-card-glyph-line" d="M46 50 L60 20 L74 50" />
      <path className="vc-card-glyph-line" d="M46 50 L60 134 L74 50" />
    </>
  );
}

function FlameGlyph() {
  return (
    <>
      <path
        className="vc-card-glyph-accent"
        d="M62 132 C36 122 28 99 38 77 C45 62 60 55 58 28 C81 48 94 70 88 94 C84 113 75 126 62 132 Z"
      />
      <path
        className="vc-card-glyph-highlight"
        d="M60 124 C49 117 47 103 53 91 C58 81 67 76 66 58 C79 74 80 94 72 110 C69 117 65 122 60 124 Z"
      />
    </>
  );
}

function SuitGlyph({ size, suit }: SuitGlyphProps) {
  const scale = size === "corner" ? 0.25 : 0.72;
  const translate = size === "corner" ? "0 35" : "16 30";

  return (
    <g className={`vc-card-glyph vc-card-glyph-${suit}`} transform={`translate(${translate}) scale(${scale})`}>
      {suit === "spades" ? <SwordGlyph /> : null}
      {suit === "clubs" ? <MorningstarGlyph /> : null}
      {suit === "diamonds" ? <RubyGlyph /> : null}
      {suit === "hearts" ? <FlameGlyph /> : null}
    </g>
  );
}

export function CardView({ card, selected = false, disabled = false, onClick }: CardViewProps) {
  const isRed = redSuits.includes(card.suit);
  const tapAndHoverProps = disabled
    ? {}
    : {
        whileHover: { y: -8 },
        whileTap: { scale: 0.96 }
      };

  return (
    <motion.button
      layout
      {...tapAndHoverProps}
      className={`vc-card ${isRed ? "vc-card-red" : "vc-card-black"} ${selected ? "is-selected" : ""}`}
      disabled={disabled}
      type="button"
      onClick={() => onClick?.(card)}
      aria-pressed={selected}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <svg viewBox="0 0 120 168" role="img" aria-hidden="true">
        <rect x="2" y="2" width="116" height="164" rx="10" />
        <text x="14" y="28" className="vc-card-rank">
          {card.rank}
        </text>
        <SuitGlyph suit={card.suit} size="corner" />
        <SuitGlyph suit={card.suit} size="center" />
        <g transform="rotate(180 60 84)">
          <text x="14" y="28" className="vc-card-rank">
            {card.rank}
          </text>
          <SuitGlyph suit={card.suit} size="corner" />
        </g>
      </svg>
    </motion.button>
  );
}
