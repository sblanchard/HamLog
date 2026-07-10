-- HamLog database schema
-- This runs automatically on first Docker container startup.

CREATE TABLE IF NOT EXISTS `Users` (
  `id` INT AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `callsign` VARCHAR(12) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `users_username_unique` (`username`),
  UNIQUE INDEX `users_callsign_unique` (`callsign`)
);

CREATE TABLE IF NOT EXISTS `Contacts` (
  `QSO_ID` INT AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `QSO_Date` DATETIME NULL,
  `QSO_MTZTime` VARCHAR(12) NULL,
  `QSO_Callsign` VARCHAR(12) NULL,
  `QSO_Frequency` VARCHAR(15) NULL,
  `QSO_Notes` VARCHAR(4096) NULL,
  `QSO_Received` VARCHAR(10) NULL,
  `QSO_Sent` VARCHAR(10) NULL,
  `qso_datetime_utc` DATETIME NULL,
  `frequency_mhz` DECIMAL(10,6) NULL,
  `mode` VARCHAR(20) NULL,
  `band` VARCHAR(10) NULL,
  PRIMARY KEY (`QSO_ID`),
  INDEX `idx_contacts_user_id` (`user_id`),
  INDEX `idx_contacts_dedup` (`user_id`, `QSO_Callsign`, `qso_datetime_utc`),
  CONSTRAINT `fk_contacts_user_id` FOREIGN KEY (`user_id`) REFERENCES `Users`(`id`) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS `POTA_QSOs` (
  `POTA_QSO_ID` INT AUTO_INCREMENT,
  `QSO_ID` INT,
  `POTAPark_ID` VARCHAR(10),
  `QSO_Type` VARCHAR(2),
  PRIMARY KEY (`POTA_QSO_ID`),
  FOREIGN KEY (`QSO_ID`) REFERENCES `Contacts`(`QSO_ID`)
);

CREATE TABLE IF NOT EXISTS `Contests` (
  `CONTEST_ID` INT AUTO_INCREMENT,
  `CONTEST_NAME` VARCHAR(512),
  `CONTEST_DESCRIPTION` VARCHAR(1024),
  `CONTEST_BEGINS_ON_DATE` DATETIME NULL,
  `CONTEST_BEGINS_ON_TIME` DATETIME NULL,
  `CONTEST_ENDS_ON_DATE` DATETIME NULL,
  `CONTEST_ENDS_ON_TIME` DATETIME NULL,
  `CONTEST_EXCHANGE_DATA` VARCHAR(1024) NULL,
  PRIMARY KEY (`CONTEST_ID`)
);

CREATE TABLE IF NOT EXISTS `Contest_QSOs` (
  `CONTEST_QSO_ID` INT AUTO_INCREMENT,
  `QSO_ID` INT,
  `CONTEST_ID` INT,
  `CONTEST_QSO_NUMBER` VARCHAR(10),
  `CONTEST_QSO_EXCHANGE_DATA` VARCHAR(128),
  PRIMARY KEY (`CONTEST_QSO_ID`),
  FOREIGN KEY (`QSO_ID`) REFERENCES `Contacts`(`QSO_ID`),
  FOREIGN KEY (`CONTEST_ID`) REFERENCES `Contests`(`CONTEST_ID`)
);

-- This schema is the FINAL shape — it already includes everything migrations
-- 001-008 would add. Seed the migration tracker so the app's migration runner
-- doesn't re-apply them against a fresh database (re-applying 001 fails with
-- "Duplicate column name" and blocks every later migration from ever running).
-- Keep this list in sync with MIGRATIONS in src/migrations/migrate.ts whenever
-- a new migration's effect gets folded into this schema.
CREATE TABLE IF NOT EXISTS `_migrations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL UNIQUE,
  `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO `_migrations` (`name`) VALUES
  ('001-add-utc-datetime.sql'),
  ('002-add-frequency-decimal.sql'),
  ('003-add-mode-band.sql'),
  ('004-add-users-table.sql'),
  ('005-add-user-id-to-contacts.sql'),
  ('006-backfill-user-id.sql'),
  ('007-user-id-not-null.sql'),
  ('008-add-contacts-dedup-index.sql');

CREATE TABLE IF NOT EXISTS `ContactInfo` (
  `ContactInfo_ID` INT NOT NULL AUTO_INCREMENT,
  `ContactInfo_Callsign` VARCHAR(10) NOT NULL,
  `ContactInfo_Name` VARCHAR(100) NULL,
  `ContactInfo_Street` VARCHAR(100) NULL,
  `ContactInfo_City` VARCHAR(100) NULL,
  `ContactInfo_usState` VARCHAR(100) NULL,
  `ContactInfo_AddressCountry` VARCHAR(100) NULL,
  `ContactInfo_Latitude` VARCHAR(100) NULL,
  `ContactInfo_Longitude` VARCHAR(100) NULL,
  `ContactInfo_ITUZone` VARCHAR(100) NULL,
  `ContactInfo_GridSquare` VARCHAR(100) NULL,
  `ContactInfo_QTH` VARCHAR(100) NULL,
  `ContactInfo_Country` VARCHAR(100) NULL,
  PRIMARY KEY (`ContactInfo_ID`),
  UNIQUE INDEX `ContactInfo_Callsigh_UNIQUE` (`ContactInfo_Callsign` ASC)
);
