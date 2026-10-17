begin;
-- A minute tick leaves enough time for bounded live fallback groups before email.
select cron.alter_job(job_id:=jobid,schedule:='* * * * *') from cron.job where jobname='signals-pipeline-worker';
commit;
