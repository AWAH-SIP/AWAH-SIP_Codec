#!/bin/bash

mkdir build && cd build
qmake CONFIG+=release PREFIX=/usr ../AWAH-SIP_Codec.pro
make -j$(nproc)
make INSTALL_ROOT=appdir -j$(nproc) install
linuxdeployqt-continuous-x86_64.AppImage appdir/usr/share/applications/*.desktop -appimage -verbose=2