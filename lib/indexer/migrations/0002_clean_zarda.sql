CREATE TABLE "holder_balances" (
	"token_address" text NOT NULL,
	"wallet_address" text NOT NULL,
	"balance_raw" numeric(78, 0) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holder_balances_token_address_wallet_address_pk" PRIMARY KEY("token_address","wallet_address")
);
--> statement-breakpoint
CREATE TABLE "tracked_tokens" (
	"token_address" text PRIMARY KEY NOT NULL,
	"first_tracked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_snapshot_at" timestamp with time zone
);
