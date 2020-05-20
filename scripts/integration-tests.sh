#!/usr/bin/env bash

# First this script will deploy from an instance of unlock:latest
REPO_ROOT=`dirname "$0"`/..
BASE_DOCKER_COMPOSE=$REPO_ROOT/docker/docker-compose.yml
DOCKER_COMPOSE_CI=$REPO_ROOT/docker/docker-compose.ci.yml
EXTRA_ARGS=$*

mkdir -p /tmp/screenshots
chmod 0777 /tmp/screenshots

# Take cluster down to start "clean"
# TODO Let's make this optional via command line to make local dev easier
docker-compose -f $BASE_DOCKER_COMPOSE -f $DOCKER_COMPOSE_CI down

# Improvment:
# At this point, docker-compose will builds the images it needs for the cluster.
# However it does that in an not particularly smart way (no concurrency, no use of existing cache
# ...). In order to imporve this we could manually build the images we need using the speed
# improvments we want. We already have a script to build images with build-image.sh which should
# make that easy.

# Let's take the cluster up
# This will give some time for servers to start (and run prestart scripts)
docker-compose -f $BASE_DOCKER_COMPOSE -f $DOCKER_COMPOSE_CI up

# Deploy the subgraph
# TODO make the script idempotent so that it does not deploy twice!
docker-compose -f $BASE_DOCKER_COMPOSE -f $DOCKER_COMPOSE_CI up subgraph_deployment

# Deploy the smart contract
# TODO: make the script idempotent so that it does not deploy twice!
docker-compose -f $BASE_DOCKER_COMPOSE -f $DOCKER_COMPOSE_CI up ganache-standup

# And then run the integration tests
COMMAND="yarn run ci"
docker-compose -f $BASE_DOCKER_COMPOSE -f $DOCKER_COMPOSE_CI run -e UNLOCK_ENV=test -v /tmp/screenshots:/screenshots $EXTRA_ARGS integration-tests bash -c "$COMMAND"
