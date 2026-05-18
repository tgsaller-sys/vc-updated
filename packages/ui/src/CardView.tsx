import { motion } from "framer-motion";
import type { Card } from "@vc/game";
import "./cards.css";

const suitSymbols: Readonly<Record<Card["suit"], string>> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠"
};

const redSuits: readonly Card["suit"][] = ["diamonds", "hearts"];

export interface CardViewProps {
  readonly card: Card;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly onClick?: (card: Card) => void;
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
      animate={{ y: selected ? -24 : 0 }}
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
        <text x="14" y="50" className="vc-card-corner-suit">
          {suitSymbols[card.suit]}
        </text>
        <text x="60" y="98" className="vc-card-suit">
          {suitSymbols[card.suit]}
        </text>
        <g transform="rotate(180 60 84)">
          <text x="14" y="28" className="vc-card-rank">
            {card.rank}
          </text>
          <text x="14" y="50" className="vc-card-corner-suit">
            {suitSymbols[card.suit]}
          </text>
        </g>
      </svg>
    </motion.button>
  );
}
