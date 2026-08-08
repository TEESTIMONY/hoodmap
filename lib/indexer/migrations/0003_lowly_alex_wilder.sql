CREATE TABLE "tracked_wallets" (
	"wallet_address" text PRIMARY KEY NOT NULL,
	"first_tracked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tracked_from_block" bigint NOT NULL,
	"backfill_cursor_block" bigint,
	"backfill_complete" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transfers" (
	"wallet_address" text NOT NULL,
	"token_address" text NOT NULL,
	"counterparty" text NOT NULL,
	"direction" text NOT NULL,
	"value_raw" numeric(78, 0) NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_timestamp" timestamp with time zone,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_transfers_wallet_address_tx_hash_log_index_pk" PRIMARY KEY("wallet_address","tx_hash","log_index")
);
--> statement-breakpoint
CREATE INDEX "wallet_transfers_wallet_block_idx" ON "wallet_transfers" USING btree ("wallet_address","block_number");