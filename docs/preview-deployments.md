# Vercel Preview deployments

The `v1-modular` branch is used for Preview deployments while the Production branch tracking is set to `production-paused`. Keep Production on its current deployment until a Production release is explicitly approved.

Preview is connected to the separate Supabase project `taqdmdghdqnczioxhajb`. The existing Production Supabase project `nioqaweibbtwxwpipqpe` is retained with its data. The migration history has been applied to the new project.

For this private repository on Vercel Hobby, deployments are blocked when the commit author does not have contributing access to the Vercel project. Use a GitHub account that Vercel recognizes as having access when committing changes intended to generate a Preview.
