cmake_minimum_required(VERSION 3.16)
project(AWAH_SIP_Codec LANGUAGES CXX VERSION 3.3.0)

# specify the C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_INCLUDE_CURRENT_DIR OFF)

# set QT-Specific Options
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# control where the static and shared libraries are built so that on windows
# we don't need to tinker with the path to run the executable
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${PROJECT_BINARY_DIR}")

# configure a header file to pass some of the CMake settings
# to the source code
configure_file(src/AWAH-SIP_Codec_Config.h.in src/AWAH-SIP_Codec_Config.h)

find_package(QT NAMES Qt6 COMPONENTS Core REQUIRED)
find_package(Qt${QT_VERSION_MAJOR} COMPONENTS Core REQUIRED)
find_package(Qt6Core5Compat REQUIRED)

set(PJSIP_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR}/awah-sip_library/third-party/pjproject)
set(PJSIP_INSTALL_DIR ${CMAKE_CURRENT_BINARY_DIR}/pjproject-install)

# Build and install pjproject during configuration phase
message(STATUS "Building PJSIP at configuration time...")
if(APPLE)
    set(ARCH_FLAGS "-arch arm64")
    set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${ARCH_FLAGS}")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${ARCH_FLAGS}")
endif()
# Execute the external build process for pjproject
execute_process(
    COMMAND CC=${CMAKE_C_COMPILER} CXX=${CMAKE_CXX_COMPILER} CFLAGS='${CMAKE_C_FLAGS}' CXXFLAGS='${CMAKE_CXX_FLAGS}' ./configure --prefix=${PJSIP_INSTALL_DIR} --disable-video && make dep && make
    COMMAND make dep
    WORKING_DIRECTORY ${PJSIP_SOURCE_DIR}
    RESULT_VARIABLE result
    OUTPUT_VARIABLE output
    ERROR_VARIABLE error
)
if(result)
    message(FATAL_ERROR "pjproject build failed: ${error}")
else()
    message(STATUS "pjproject built successfully: ${output}")
endif()

execute_process(
    COMMAND make
    COMMAND make install
    WORKING_DIRECTORY ${PJSIP_SOURCE_DIR}
    RESULT_VARIABLE result2
    OUTPUT_VARIABLE output2
    ERROR_VARIABLE error2
)
if(result2)
    message(FATAL_ERROR "pjproject build failed: ${error2}")
else()
    message(STATUS "pjproject built successfully: ${output2}")
endif()

# Add library paths to make sure pjproject libraries are found
link_directories(${PJSIP_INSTALL_DIR}/lib)

# Specify the include directories for pjproject
include_directories(${PJSIP_INSTALL_DIR}/include)

# Finde pkg-config und PJSIP, falls verfügbar
set(ENV{PKG_CONFIG_PATH} "${PJSIP_INSTALL_DIR}/lib/pkgconfig:$ENV{PKG_CONFIG_PATH}")
find_package(PkgConfig REQUIRED)

# Set up pkg-config for libpjproject
pkg_search_module(PKG_PJSIP REQUIRED IMPORTED_TARGET libpjproject)

pkg_search_module(PKG_OPUS REQUIRED IMPORTED_TARGET opus)

# Füge hier das Submodul hinzu, nachdem pjproject gebaut wurde
add_subdirectory(awah-sip_library)

#add windows AppIcon
if(WIN32)
    list(APPEND ADDITIONAL_FILES "images/AWAH-SIP_Codec.rc")
endif()

# add the executable
add_executable(AWAH_SIP_Codec
                                src/main.cpp
                                ${ADDITIONAL_FILES})

# Link libraries including pjproject
target_link_libraries(AWAH_SIP_Codec PUBLIC
                      Qt${QT_VERSION_MAJOR}::Core
                      AWAH_SIP_Library
                      PkgConfig::PKG_PJSIP
                      PkgConfig::PKG_OPUS)

if(PKG_PJSIP_STATIC_LDFLAGS)
    # Frameworks extrahieren und separat hinzufügen
    foreach(flag ${PKG_PJSIP_STATIC_LDFLAGS})
        if(flag STREQUAL "-framework")
            set(IS_FRAMEWORK TRUE)
        elseif(IS_FRAMEWORK)
            list(APPEND FRAMEWORKS "-framework ${flag}")
            set(IS_FRAMEWORK FALSE)
        else()
            list(APPEND OTHER_LDFLAGS ${flag})
        endif()
    endforeach()

    # Füge die anderen Flags und Frameworks hinzu
    target_link_libraries(AWAH_SIP_Codec PRIVATE ${OTHER_LDFLAGS} ${FRAMEWORKS})
endif()



# add the binary tree to the search path for include files
# so that we will find AWAH-SIP_Codec_Config.h
target_include_directories(AWAH_SIP_Codec PUBLIC
                           "${PROJECT_BINARY_DIR}"
                           )

# add the install targets
install(TARGETS AWAH_SIP_Codec DESTINATION bin)
install(FILES "${PROJECT_BINARY_DIR}/src/AWAH-SIP_Codec_Config.h"
  DESTINATION include
  )

# setup installer
include(InstallRequiredSystemLibraries)
set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/LICENSE")
set(CPACK_PACKAGE_VERSION_MAJOR "${AWAH_SIP_Codec_VERSION_MAJOR}")
set(CPACK_PACKAGE_VERSION_MINOR "${AWAH_SIP_Codec_VERSION_MINOR}")
set(CPACK_PACKAGE_VERSION_PATCH "${AWAH_SIP_Codec_VERSION_PATCH}")
set(CPACK_SOURCE_GENERATOR "TGZ")
include(CPack)

message( "Version: ${AWAH_SIP_Codec_VERSION_MAJOR}.${AWAH_SIP_Codec_VERSION_MINOR}.${AWAH_SIP_Codec_VERSION_PATCH}" )
