-- NULL retains the original meeting-glossary behavior for existing tasks.
ALTER TABLE jobs ADD COLUMN language_pair TEXT;
