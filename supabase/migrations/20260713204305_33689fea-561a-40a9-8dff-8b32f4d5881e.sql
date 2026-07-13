
-- Grant agency role and seed sample clients
INSERT INTO public.user_roles (user_id, role) VALUES ('1a3877c5-4146-46dc-b49b-24028a085e09', 'agency')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.agency_clients (agency_user_id, name, status, current_balance, threshold, next_warning_date, next_warning_amount, notes) VALUES
('1a3877c5-4146-46dc-b49b-24028a085e09', 'Nordic Design AB', 'green', 145000, 20000, NULL, NULL, 'Stabilt kassaflöde, inga varningar'),
('1a3877c5-4146-46dc-b49b-24028a085e09', 'Byggteknik Stockholm', 'yellow', 42000, 30000, CURRENT_DATE + 9, 28500, 'Bevaka löneutbetalning nästa vecka'),
('1a3877c5-4146-46dc-b49b-24028a085e09', 'Café Solrosen', 'red', 8500, 15000, CURRENT_DATE + 3, -4200, 'Åtgärd krävs - saldot går under 0 om 3 dagar'),
('1a3877c5-4146-46dc-b49b-24028a085e09', 'Mediabolaget Norr', 'green', 89000, 25000, NULL, NULL, 'Stark likviditet'),
('1a3877c5-4146-46dc-b49b-24028a085e09', 'Hantverkarna i Söder', 'yellow', 31000, 20000, CURRENT_DATE + 11, 18200, 'Bevaka skatteinbetalning');
