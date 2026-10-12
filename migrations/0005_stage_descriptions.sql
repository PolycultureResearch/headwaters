-- What a lead in this stage is, shown under the stage name on the board.
-- exit_criteria says what moves a lead out; this says what being here means.
ALTER TABLE stages ADD COLUMN description TEXT;

UPDATE stages SET description = 'A company worth approaching. No contact yet.' WHERE id = 'lead';
UPDATE stages SET description = 'Outreach sent. Waiting for a reply.' WHERE id = 'contacted';
UPDATE stages SET description = 'A first conversation is on the calendar.' WHERE id = 'meeting-booked';
UPDATE stages SET description = 'We have talked and there is a need we can meet.' WHERE id = 'qualified';
UPDATE stages SET description = 'A proposal is with them, awaiting a decision.' WHERE id = 'proposal-out';
UPDATE stages SET description = 'Signed. A client.' WHERE id = 'won';
UPDATE stages SET description = 'Not now, but worth coming back to.' WHERE id = 'dormant';
UPDATE stages SET description = 'Not going ahead.' WHERE id = 'lost';
