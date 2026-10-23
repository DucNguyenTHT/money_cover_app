-- Telegram file_id of each invoice file sent to the backup chat (to download it again if lost on disk).

-- AlterTable
ALTER TABLE "document_files" ADD COLUMN     "telegram_file_id" TEXT;
