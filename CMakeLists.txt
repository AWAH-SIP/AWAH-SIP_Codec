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
    # Überprüfen, ob -arch bereits vorhanden ist
    string(FIND "${CMAKE_C_FLAGS}" "-arch" C_FLAGS_HAS_ARM64)
    string(FIND "${CMAKE_CXX_FLAGS}" "-arch" CXX_FLAGS_HAS_ARM64)
    
    set(ARCH_FLAGS "-arch arm64")

    # Nur hinzufügen, wenn nicht bereits vorhanden
    if(C_FLAGS_HAS_ARM64 EQUAL -1)
        set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${ARCH_FLAGS}")
        message(STATUS "Adding -arch arm64 to C compiler flags")
    endif()
    
    if(CXX_FLAGS_HAS_ARM64 EQUAL -1)
        set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${ARCH_FLAGS}")
        message(STATUS "Adding -arch arm64 to CXX compiler flags")
    endif()
endif()
# Finde Opus via pkg-config
find_package(PkgConfig REQUIRED)
pkg_search_module(OPUS REQUIRED opus)

# Ausgabe zur Kontrolle
message(STATUS "Opus include dirs: ${OPUS_INCLUDE_DIRS}")
message(STATUS "Opus library dirs: ${OPUS_LIBRARY_DIRS}")
message(STATUS "Opus libraries: ${OPUS_LIBRARIES}")
message(STATUS "Opus pkgconfig path: ${OPUS_PKGCONFIG_PATH}")  # manchmal leer

# Setze Umgebungsvariablen für ./configure auf Basis der gefundenen Werte
# CFLAGS: -I für jeden Include-Pfad
string(REPLACE ";" " " OPUS_CFLAGS_STR "-I${OPUS_INCLUDE_DIRS}")
set(ENV{CFLAGS} "${OPUS_CFLAGS_STR}")

# LDFLAGS: -L für jeden Library-Pfad + -l für jede Library
string(REPLACE ";" " " OPUS_LDFLAGS_STR "-L${OPUS_LIBRARY_DIRS}")
string(REPLACE ";" " -l" OPUS_LIBS_STR "-l${OPUS_LIBRARIES}")
set(ENV{LDFLAGS} "${OPUS_LDFLAGS_STR} ${OPUS_LIBS_STR}")

# Setze PKG_CONFIG_PATH auf Basis der gefundenen Library-Pfade
foreach(dir IN LISTS OPUS_LIBRARY_DIRS)
    list(APPEND _pkgconfig_paths "${dir}/pkgconfig")
endforeach()

# Baue den Pfad-String mit Doppelpunkten (Unix)
list(JOIN _pkgconfig_paths ":" OPUS_PKGCONFIG_PATH)

# Debug-Ausgabe
message(STATUS "Dynamisch gesetzter OPUS_PKGCONFIG_PATH: ${OPUS_PKGCONFIG_PATH}")

# Setze als ENV-Variable
set(ENV{PKG_CONFIG_PATH} "${OPUS_PKGCONFIG_PATH}")

# Execute the external build process for pjproject
message(STATUS "PJSIP source directory: ${PJSIP_SOURCE_DIR}")
message(STATUS "PJSIP install directory: ${PJSIP_INSTALL_DIR}")
execute_process(
    COMMAND ./configure --prefix=${PJSIP_INSTALL_DIR} --disable-video
    WORKING_DIRECTORY ${PJSIP_SOURCE_DIR}
    RESULT_VARIABLE result
    OUTPUT_VARIABLE output
    ERROR_VARIABLE error
)
if(result)
    message(FATAL_ERROR "pjproject configure failed: ${error} | ${output} | ${result}")
else()
    message(STATUS "pjproject configured successfully: ${output}")
endif()
execute_process(
    COMMAND make dep
    WORKING_DIRECTORY ${PJSIP_SOURCE_DIR}
    RESULT_VARIABLE result
    OUTPUT_VARIABLE output
    ERROR_VARIABLE error
)
if(result)
    message(FATAL_ERROR "pjproject build dep failed: ${error}")
else()
    message(STATUS "pjproject built deps successfully: ${output}")
endif()

execute_process(
    COMMAND make
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

execute_process(
    COMMAND make install
    WORKING_DIRECTORY ${PJSIP_SOURCE_DIR}
    RESULT_VARIABLE result3
    OUTPUT_VARIABLE output3
    ERROR_VARIABLE error3
)
if(result3)
    message(FATAL_ERROR "pjproject install failed: ${error3}")
else()
    message(STATUS "pjproject installed successfully: ${output3}")
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
                      PkgConfig::PKG_PJSIP)

target_link_libraries(AWAH_SIP_Codec PRIVATE ${PKG_OPUS_STATIC_LDFLAGS})

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

# Erstelle ein benutzerdefinierten Target für "pjsip-clean"
add_custom_target(pjsip-clean
    COMMAND make clean
    WORKING_DIRECTORY ${PJSIP_SOURCE_DIR}
    COMMENT "Cleaning PJSIP build files"
    VERBATIM
)

# Verbinde den Standard "clean" Target mit unserem benutzerdefinierten Target
set_property(DIRECTORY APPEND PROPERTY ADDITIONAL_CLEAN_FILES
    "${PJSIP_INSTALL_DIR}"
)

# Füge einen Hinweis hinzu, wie man PJSIP manuell bereinigen kann
message(STATUS "To clean PJSIP manually, run 'make pjsip-clean'")

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
