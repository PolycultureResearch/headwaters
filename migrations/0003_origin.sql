-- Where a lead came from: a short reusable channel, plus the specifics.
ALTER TABLE leads ADD COLUMN origin TEXT;
ALTER TABLE leads ADD COLUMN origin_detail TEXT;
