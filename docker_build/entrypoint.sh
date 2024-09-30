#!/bin/bash

ADDITIONAL_ARGS="${@:2}"


if [ "$1" = "build" ]; then
	echo "Starting to build your project..."
	# unfortunately we have to specify the actual environment var here, because passing it in via CMD does not work with environment variables: https://docs.docker.com/engine/reference/builder/#environment-replacement
	if [ -z "$(ls -A $APP_SRCDIR)" ]; then
		echo "Mount point /var/build is empty, did you invoke the container with \"docker run --rm -v /path/to/qmake/project:/var/build qt-build:tag build\"?"
		exit 0
	else
		mkdir -p $APP_BUILDDIR
		cd $APP_BUILDDIR
		/sysroot/usr/local/bin/qmake $ADDITIONAL_ARGS $APP_SRCDIR
		make
	fi
else
	cd ~
	echo "If you wanted to use the container to build a qmake project, you have to invoke the container with command \"build\" and mount the project to /var/src"
	echo "Invoking container with command(s) ${@}..."
	"${@}"
fi
