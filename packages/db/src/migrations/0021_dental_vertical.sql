ALTER TABLE "company" ADD COLUMN "vertical" text DEFAULT 'construction';
--> statement-breakpoint
UPDATE "company" SET "vertical" = 'construction' WHERE "vertical" IS NULL;
--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "vertical" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "company" ALTER COLUMN "vertical" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_vertical_check" CHECK ("vertical" in ('construction', 'dental'));
--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_company_id_key" UNIQUE("company_id","id");
--> statement-breakpoint
CREATE TABLE "dental_patient" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"record_number" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"date_of_birth" date,
	"sex" text DEFAULT 'unknown' NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"medical_alerts" text,
	"allergies" text,
	"medications" text,
	"notes" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dental_patient_company_record_key" UNIQUE("company_id","record_number"),
	CONSTRAINT "dental_patient_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "dental_patient_sex_check" CHECK ("sex" in ('female', 'male', 'other', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "dental_practitioner" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider_code" text NOT NULL,
	"display_name" text NOT NULL,
	"specialty" text,
	"phone" text,
	"color" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dental_practitioner_company_user_key" UNIQUE("company_id","user_id"),
	CONSTRAINT "dental_practitioner_company_code_key" UNIQUE("company_id","provider_code"),
	CONSTRAINT "dental_practitioner_company_id_key" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "dental_appointment" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"appointment_type" text NOT NULL,
	"reason" text,
	"notes" text,
	"cancellation_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dental_appointment_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "dental_appointment_time_check" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "dental_appointment_status_check" CHECK ("status" in ('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'))
);
--> statement-breakpoint
CREATE TABLE "dental_treatment_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"presented_at" timestamp,
	"accepted_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dental_treatment_plan_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "dental_treatment_plan_status_check" CHECK ("status" in ('draft', 'presented', 'accepted', 'in_progress', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "dental_treatment_item" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"treatment_plan_id" text NOT NULL,
	"appointment_id" text,
	"procedure_code" text NOT NULL,
	"procedure_name" text NOT NULL,
	"tooth_number" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"fee" numeric(14, 2) NOT NULL,
	"notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dental_treatment_item_fee_check" CHECK ("fee" >= 0),
	CONSTRAINT "dental_treatment_item_status_check" CHECK ("status" in ('planned', 'scheduled', 'in_progress', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "dental_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"patient_id" text NOT NULL,
	"treatment_plan_id" text,
	"appointment_id" text,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"notes" text,
	"paid_at" timestamp NOT NULL,
	"received_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dental_payment_amount_check" CHECK ("amount" > 0),
	CONSTRAINT "dental_payment_status_check" CHECK ("status" in ('pending', 'completed', 'refunded', 'void')),
	CONSTRAINT "dental_payment_method_check" CHECK ("method" in ('cash', 'card', 'bank_transfer', 'insurance', 'other'))
);
--> statement-breakpoint
ALTER TABLE "dental_patient" ADD CONSTRAINT "dental_patient_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_practitioner" ADD CONSTRAINT "dental_practitioner_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_practitioner" ADD CONSTRAINT "dental_practitioner_company_user_fk" FOREIGN KEY ("company_id","user_id") REFERENCES "public"."user"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_appointment" ADD CONSTRAINT "dental_appointment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_appointment" ADD CONSTRAINT "dental_appointment_company_patient_fk" FOREIGN KEY ("company_id","patient_id") REFERENCES "public"."dental_patient"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_appointment" ADD CONSTRAINT "dental_appointment_company_practitioner_fk" FOREIGN KEY ("company_id","practitioner_id") REFERENCES "public"."dental_practitioner"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_treatment_plan" ADD CONSTRAINT "dental_treatment_plan_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_treatment_plan" ADD CONSTRAINT "dental_treatment_plan_company_patient_fk" FOREIGN KEY ("company_id","patient_id") REFERENCES "public"."dental_patient"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_treatment_item" ADD CONSTRAINT "dental_treatment_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_treatment_item" ADD CONSTRAINT "dental_treatment_item_company_plan_fk" FOREIGN KEY ("company_id","treatment_plan_id") REFERENCES "public"."dental_treatment_plan"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_treatment_item" ADD CONSTRAINT "dental_treatment_item_company_appointment_fk" FOREIGN KEY ("company_id","appointment_id") REFERENCES "public"."dental_appointment"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_payment" ADD CONSTRAINT "dental_payment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_payment" ADD CONSTRAINT "dental_payment_company_patient_fk" FOREIGN KEY ("company_id","patient_id") REFERENCES "public"."dental_patient"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_payment" ADD CONSTRAINT "dental_payment_company_plan_fk" FOREIGN KEY ("company_id","treatment_plan_id") REFERENCES "public"."dental_treatment_plan"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_payment" ADD CONSTRAINT "dental_payment_company_appointment_fk" FOREIGN KEY ("company_id","appointment_id") REFERENCES "public"."dental_appointment"("company_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dental_payment" ADD CONSTRAINT "dental_payment_received_by_id_user_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "dental_patient_company_name_idx" ON "dental_patient" USING btree ("company_id","last_name","first_name");
--> statement-breakpoint
CREATE INDEX "dental_patient_company_archived_idx" ON "dental_patient" USING btree ("company_id","archived_at");
--> statement-breakpoint
CREATE INDEX "dental_practitioner_company_active_idx" ON "dental_practitioner" USING btree ("company_id","active");
--> statement-breakpoint
CREATE INDEX "dental_appointment_company_start_idx" ON "dental_appointment" USING btree ("company_id","starts_at");
--> statement-breakpoint
CREATE INDEX "dental_appointment_company_status_start_idx" ON "dental_appointment" USING btree ("company_id","status","starts_at");
--> statement-breakpoint
CREATE INDEX "dental_appointment_patient_start_idx" ON "dental_appointment" USING btree ("patient_id","starts_at");
--> statement-breakpoint
CREATE INDEX "dental_appointment_practitioner_start_idx" ON "dental_appointment" USING btree ("practitioner_id","starts_at");
--> statement-breakpoint
CREATE INDEX "dental_treatment_plan_company_status_idx" ON "dental_treatment_plan" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "dental_treatment_plan_patient_idx" ON "dental_treatment_plan" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "dental_treatment_item_company_status_idx" ON "dental_treatment_item" USING btree ("company_id","status");
--> statement-breakpoint
CREATE INDEX "dental_treatment_item_plan_idx" ON "dental_treatment_item" USING btree ("treatment_plan_id");
--> statement-breakpoint
CREATE INDEX "dental_treatment_item_appointment_idx" ON "dental_treatment_item" USING btree ("appointment_id");
--> statement-breakpoint
CREATE INDEX "dental_treatment_item_completed_idx" ON "dental_treatment_item" USING btree ("company_id","completed_at");
--> statement-breakpoint
CREATE INDEX "dental_payment_company_paid_idx" ON "dental_payment" USING btree ("company_id","paid_at");
--> statement-breakpoint
CREATE INDEX "dental_payment_patient_paid_idx" ON "dental_payment" USING btree ("patient_id","paid_at");
--> statement-breakpoint
CREATE INDEX "dental_payment_plan_idx" ON "dental_payment" USING btree ("treatment_plan_id");
