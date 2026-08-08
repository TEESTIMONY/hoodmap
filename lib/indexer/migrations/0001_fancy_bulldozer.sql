CREATE TABLE "wallet_funders" (
	"token_address" text NOT NULL,
	"wallet_address" text NOT NULL,
	"funder_address" text NOT NULL,
	"first_funded_block" bigint NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_funders_token_address_wallet_address_pk" PRIMARY KEY("token_address","wallet_address")
);
--> statement-breakpoint
CREATE INDEX "wallet_funders_token_funder_idx" ON "wallet_funders" USING btree ("token_address","funder_address");