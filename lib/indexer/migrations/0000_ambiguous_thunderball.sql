CREATE TABLE "sync_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_synced_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_metadata_cache" (
	"address" text PRIMARY KEY NOT NULL,
	"name" text,
	"symbol" text,
	"decimals" integer,
	"total_supply_raw" numeric(78, 0),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transfers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_address" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"value_raw" numeric(78, 0) NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_timestamp" timestamp with time zone,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_tx_log_idx" ON "transfers" USING btree ("tx_hash","log_index");--> statement-breakpoint
CREATE INDEX "transfers_token_block_idx" ON "transfers" USING btree ("token_address","block_number");--> statement-breakpoint
CREATE INDEX "transfers_from_idx" ON "transfers" USING btree ("from_address");--> statement-breakpoint
CREATE INDEX "transfers_to_idx" ON "transfers" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "transfers_block_idx" ON "transfers" USING btree ("block_number");