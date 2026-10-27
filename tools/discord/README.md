# Chef Special to Discord

`.github/workflows/chef-discord.yml` runs `post_chef_special.py` when a new Chef Special lands on main.
It waits for the deploy to serve the special's page and share image, then posts an embed (title, champion,
augments, items, share image, link to `/kitchen/<date>`) to the webhook in the `DISCORD_CHEF_WEBHOOK`
repo secret. Without the secret it does nothing. Re-post a date by hand: Actions > Chef Special to Discord > Run workflow.

Setup: in Discord, create the channel, Edit Channel > Integrations > Webhooks > New Webhook > Copy Webhook URL,
then add it in GitHub under Settings > Secrets and variables > Actions as `DISCORD_CHEF_WEBHOOK`.
