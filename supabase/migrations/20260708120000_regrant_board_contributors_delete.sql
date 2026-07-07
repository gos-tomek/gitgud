-- Re-grant DELETE on board_contributors to authenticated.
-- The expand change's 20260707120000_contract_drop_board_pat.sql narrowed grants
-- to SELECT+INSERT only, with an explicit note that DELETE would be re-granted
-- when contributor management ships. This migration fulfills that contract.
GRANT DELETE ON public.board_contributors TO authenticated;
