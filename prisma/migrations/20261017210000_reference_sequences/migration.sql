-- Monotonic counters for human-facing reference numbers.
--
-- A sequence is used rather than "SELECT max(...) + 1" because the latter races
-- under concurrent inserts: two agents creating a booking at the same moment
-- would both read the same maximum and collide on the unique constraint.
-- nextval() is atomic and never hands the same value to two callers.
--
-- Sequences do not roll back, so a failed transaction burns a number. Gaps in
-- booking numbers are acceptable; duplicates are not.

CREATE SEQUENCE IF NOT EXISTS booking_number_seq START WITH 70000 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS customer_reference_seq START WITH 100000 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS payment_reference_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS refund_reference_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS chargeback_reference_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS service_case_seq START WITH 1 INCREMENT BY 1;
