-- Drop the old constraint that only allowed psychology and economics
ALTER TABLE personal_wiki_nodes
  DROP CONSTRAINT IF EXISTS personal_wiki_nodes_pillar_check;

-- Add the correct constraint with all 6 Axiom pillars plus legacy aliases
ALTER TABLE personal_wiki_nodes
  ADD CONSTRAINT personal_wiki_nodes_pillar_check
  CHECK (pillar IN (
    'psychology',
    'economics',
    'human_mind',
    'money_game',
    'how_companies_win',
    'whats_coming',
    'think_sharper',
    'move_people'
  ));
